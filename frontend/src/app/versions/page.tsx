'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import TopBar from '@/components/ui/TopBar';
import Modal from '@/components/ui/Modal';
import { api, ApiError } from '@/lib/api';
import type { FlowVersionDetail, FlowVersionNode, FlowVersionSummary } from '@/types';

export default function FlowVersionsPage() {
  const [versions, setVersions] = useState<FlowVersionSummary[]>([]);
  const versionsRef = useRef<FlowVersionSummary[]>([]);
  const [detail, setDetail] = useState<FlowVersionDetail | null>(null);
  const [prevDetail, setPrevDetail] = useState<FlowVersionDetail | null>(null);
  const [confirmDel, setConfirmDel] = useState<FlowVersionSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectVersion = useCallback(async (id: number) => {
    setDetail(await api.get<FlowVersionDetail>(`/flow/versions/${id}`));
    // For the "changed in this version" highlight, also load the previous
    // version (the next-lower flow_ver_id; list is sorted newest-first).
    const list = versionsRef.current;
    const idx = list.findIndex((v) => v.flow_ver_id === id);
    const prev = idx >= 0 ? list[idx + 1] : undefined;
    setPrevDetail(prev ? await api.get<FlowVersionDetail>(`/flow/versions/${prev.flow_ver_id}`) : null);
  }, []);

  const reload = useCallback(async () => {
    const rows = await api.get<FlowVersionSummary[]>('/flow/versions');
    setVersions(rows);
    versionsRef.current = rows;
    return rows;
  }, []);

  useEffect(() => {
    reload().then((rows) => {
      if (rows[0]) selectVersion(rows[0].flow_ver_id);
    });
  }, [reload, selectVersion]);

  async function doDelete() {
    if (!confirmDel) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(`/flow/versions/${confirmDel.flow_ver_id}`);
      if (detail?.flow_ver_id === confirmDel.flow_ver_id) {
        setDetail(null);
        setPrevDetail(null);
      }
      setConfirmDel(null);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? JSON.stringify(e.detail) : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Which rows changed vs the previous version (drives the highlight).
  const prevByNode = new Map(
    (prevDetail?.nodes ?? []).map((n) => [n.node_mas_id, n.version_no] as const),
  );
  const nodeChanged = (n: FlowVersionNode) =>
    prevByNode.has(n.node_mas_id) && prevByNode.get(n.node_mas_id) !== n.version_no;
  const mainModelChanged =
    detail != null && prevDetail != null && detail.main_model_nm !== prevDetail.main_model_nm;
  const accent = (changed: boolean) =>
    ' border-l-4 ' + (changed ? 'border-amber-400' : 'border-transparent');

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar title="전체 버전 이력" />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 overflow-auto border-r-2 border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-base font-extrabold text-slate-700">전체 버전</h2>
          {error && <div className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
          <ul className="space-y-2">
            {versions.map((v) => (
              <li
                key={v.flow_ver_id}
                className={
                  'rounded-lg border-2 transition ' +
                  (detail?.flow_ver_id === v.flow_ver_id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-400')
                }
              >
                <button onClick={() => selectVersion(v.flow_ver_id)} className="w-full p-3 text-left">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold">v{v.flow_version_no}</span>
                    {v.is_active === 'Y' && (
                      <span className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">ACTIVE</span>
                    )}
                  </div>
                  {v.change_summary && <div className="mt-1 truncate text-xs font-medium text-slate-500">{v.change_summary}</div>}
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      LLM
                    </span>
                    <span className="truncate font-mono text-slate-600">{v.main_model_nm ?? '-'}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{v.created_dt}</div>
                </button>
                {v.is_active !== 'Y' && (
                  <div className="border-t border-slate-200 px-3 py-1.5 text-right">
                    <button onClick={() => setConfirmDel(v)} className="text-xs font-bold text-red-600 hover:underline">
                      삭제
                    </button>
                  </div>
                )}
              </li>
            ))}
            {versions.length === 0 && <li className="text-sm text-slate-400">버전이 없습니다.</li>}
          </ul>
        </aside>

        <main className="flex-1 overflow-auto p-8">
          {detail ? (
            <>
              <h1 className="text-2xl font-extrabold text-slate-900">전체 버전 v{detail.flow_version_no}</h1>
              <p className="mt-1 text-sm font-medium text-slate-500">{detail.change_summary ?? '-'}</p>
              <h2 className="mb-2 mt-6 text-base font-extrabold uppercase tracking-wide text-slate-500">
                노드별 활성 프롬프트 버전
              </h2>
              <table className="w-full overflow-hidden rounded-lg border-2 border-slate-200 bg-white text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 bg-slate-50 text-left text-slate-500">
                    <th className="px-4 py-2 font-bold">노드</th>
                    <th className="px-4 py-2 font-bold">프롬프트 버전</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className={'border-b border-slate-200 ' + (mainModelChanged ? 'bg-amber-50' : 'bg-slate-50')}>
                    <td className={'px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500' + accent(mainModelChanged)}>
                      LLM 모델
                      {mainModelChanged && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold normal-case tracking-normal text-amber-700">
                          변경됨
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono font-semibold text-slate-800">
                      {detail.main_model_nm ?? '-'}
                      {mainModelChanged && (
                        <span className="ml-2 text-xs font-normal text-slate-400">← {prevDetail?.main_model_nm ?? '-'}</span>
                      )}
                    </td>
                  </tr>
                  {detail.nodes.map((n) => {
                    const changed = nodeChanged(n);
                    return (
                      <tr key={n.node_mas_id} className={'border-b border-slate-100' + (changed ? ' bg-amber-50' : '')}>
                        <td className={'px-4 py-2 font-bold text-slate-800' + accent(changed)}>
                          {n.node_nm}
                          {changed && (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-bold text-amber-700">
                              변경됨
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 font-mono">
                          {n.version_no ? `v${n.version_no}` : '— (프롬프트 없음)'}
                          {changed && prevByNode.get(n.node_mas_id) != null && (
                            <span className="ml-2 text-xs font-normal text-slate-400">← v{prevByNode.get(n.node_mas_id)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : (
            <div className="text-sm text-slate-400">버전을 선택하세요.</div>
          )}
        </main>
      </div>

      <Modal
        open={!!confirmDel}
        title="전체 버전 삭제"
        onClose={() => setConfirmDel(null)}
        footer={
          <>
            <button onClick={() => setConfirmDel(null)} className="rounded-md border-2 border-slate-300 px-4 py-2 text-sm font-bold">
              취소
            </button>
            <button onClick={doDelete} disabled={busy} className="rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              삭제
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          전체 버전 <span className="font-bold">v{confirmDel?.flow_version_no}</span> 을(를) 삭제할까요?
        </p>
        <p className="mt-2 text-sm text-slate-500">되돌릴 수 없습니다. (활성 버전은 삭제할 수 없습니다.)</p>
      </Modal>
    </div>
  );
}
