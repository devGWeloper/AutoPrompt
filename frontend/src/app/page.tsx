'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/ui/TopBar';
import MermaidGraph from '@/components/graph/MermaidGraph';
import Modal from '@/components/ui/Modal';
import { api, ApiError } from '@/lib/api';
import type { FlowCurrent, FlowNode } from '@/types';

export default function GraphHomePage() {
  const router = useRouter();
  const [flow, setFlow] = useState<FlowCurrent | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState(false);
  const [pendingModel, setPendingModel] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<FlowCurrent>('/flow/current')
      .then(setFlow)
      .catch((e) => setError(e instanceof ApiError ? JSON.stringify(e.detail) : String(e)));
  }, []);

  useEffect(() => {
    load();
    api.get<string[]>('/flow/models').then(setModels).catch(() => setModels([]));
  }, [load]);

  const clickable = useMemo(
    () => (flow?.nodes ?? []).filter((n) => n.has_prompt).map((n) => n.node_nm),
    [flow],
  );

  function openNode(node: FlowNode) {
    if (!node.has_prompt) return;
    router.push(`/nodes/${node.node_mas_id}/prompts`);
  }
  function openNodeByName(nodeNm: string) {
    const node = flow?.nodes.find((n) => n.node_nm === nodeNm);
    if (node) openNode(node);
  }

  async function changeMainModel(model: string) {
    if (!flow || model === flow.main_model_nm) return;
    setSavingModel(true);
    try {
      const updated = await api.put<FlowCurrent>('/flow/main-model', { main_model_nm: model });
      setFlow(updated);
      setPendingModel(null);
    } catch (e) {
      setError(e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
    } finally {
      setSavingModel(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar
        right={
          flow && (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-bold text-slate-500">메인 모델</span>
              {flow.main_model_editable ? (
                <select
                  value={flow.main_model_nm ?? ''}
                  disabled={savingModel}
                  onChange={(e) => setPendingModel(e.target.value)}
                  className="rounded-md border-2 border-indigo-300 bg-indigo-50 px-3 py-1 font-bold text-indigo-700"
                >
                  {!models.includes(flow.main_model_nm ?? '') && flow.main_model_nm && (
                    <option value={flow.main_model_nm}>{flow.main_model_nm}</option>
                  )}
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="rounded-md bg-indigo-100 px-3 py-1 font-bold text-indigo-700">
                  {flow.main_model_nm ?? '-'}
                </span>
              )}
              <span className="rounded-md bg-slate-900 px-3 py-1 font-bold text-white">
                플로우 v{flow.flow_version_no ?? '-'}
              </span>
            </div>
          )
        }
      />

      {error && (
        <div className="mx-6 mt-4 rounded-md border-2 border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <main className="flex flex-1 flex-col overflow-hidden p-6">
          <div className="mb-3 flex items-baseline justify-between">
            <h1 className="text-2xl font-extrabold text-slate-900">LangGraph 플로우</h1>
            <p className="text-sm font-medium text-slate-500">
              파란 노드(프롬프트 보유)를 클릭해 프롬프트를 관리하세요.
            </p>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto rounded-xl border-2 border-slate-200 bg-white p-4 shadow-sm">
            {flow?.graph_struct ? (
              <MermaidGraph
                code={flow.graph_struct}
                clickableNodes={clickable}
                onNodeClick={openNodeByName}
              />
            ) : (
              <div className="text-sm text-slate-400">그래프 정보가 없습니다.</div>
            )}
          </div>
        </main>

        <aside className="flex w-96 flex-col overflow-auto border-l-2 border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-base font-extrabold uppercase tracking-wide text-slate-500">
            노드 ({flow?.nodes.length ?? 0})
          </h2>
          <ul className="space-y-2.5">
            {(flow?.nodes ?? []).map((n) => (
              <li key={n.node_mas_id}>
                <button
                  onClick={() => openNode(n)}
                  disabled={!n.has_prompt}
                  className={
                    'w-full rounded-lg border-2 p-3.5 text-left transition ' +
                    (n.has_prompt
                      ? 'cursor-pointer border-blue-200 bg-blue-50 hover:border-blue-500'
                      : 'cursor-default border-slate-200 bg-slate-50 opacity-70')
                  }
                >
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold text-slate-900">{n.node_nm}</span>
                    {n.has_prompt ? (
                      <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">
                        LLM · v{n.active_version_no ?? '-'}
                      </span>
                    ) : (
                      <span className="rounded bg-slate-300 px-2 py-0.5 text-xs font-bold text-slate-600">
                        프롬프트 없음
                      </span>
                    )}
                  </div>
                  {n.node_desc && (
                    <div className="mt-1 text-xs font-medium text-slate-500">{n.node_desc}</div>
                  )}
                  {n.model_nm && (
                    <div className="mt-1 font-mono text-xs text-slate-400">{n.model_nm}</div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <Modal
        open={pendingModel !== null}
        title="메인 모델 변경"
        onClose={() => setPendingModel(null)}
        footer={
          <>
            <button
              onClick={() => setPendingModel(null)}
              className="rounded-md border-2 border-slate-300 px-4 py-2 text-sm font-bold"
            >
              취소
            </button>
            <button
              onClick={() => pendingModel && changeMainModel(pendingModel)}
              disabled={savingModel}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              변경
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          메인 모델을 <span className="font-bold">{pendingModel}</span> 로 변경합니다.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li><span className="font-mono">CHAT_VER_MAS.MAIN_MODEL_NM</span> 이 갱신됩니다.</li>
          <li><span className="font-bold">전체 플로우 버전이 한 단계 올라갑니다.</span></li>
        </ul>
      </Modal>
    </div>
  );
}
