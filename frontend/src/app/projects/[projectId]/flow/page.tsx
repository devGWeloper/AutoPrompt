'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import TopBar from '@/components/ui/TopBar';
import NodeCard from '@/components/graph/NodeCard';
import TraceViewer, { type TraceStep } from '@/components/test/TraceViewer';
import { api, ApiError } from '@/lib/api';
import { layoutVertical } from '@/lib/graphLayout';
import { connectFlowRunWs } from '@/lib/ws';
import type { Graph, TestRunOut } from '@/types';

const nodeTypes = { pmNode: NodeCard };

type NodeStatus = 'idle' | 'running' | 'done' | 'skipped' | 'failed';
type RunStatus = 'idle' | 'running' | 'done' | 'failed';

const BORDER: Record<NodeStatus, string> = {
  idle: '#cbd5e1',
  running: '#f59e0b',
  done: '#10b981',
  skipped: '#94a3b8',
  failed: '#ef4444',
};

export default function FlowPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = Number(params.projectId);

  const [graph, setGraph] = useState<Graph | null>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [nodeStatus, setNodeStatus] = useState<Record<number, NodeStatus>>({});
  const [status, setStatus] = useState<RunStatus>('idle');
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [varsText, setVarsText] = useState('{\n  "input": "hello"\n}');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    api
      .get<Graph>(`/projects/${projectId}/graph`)
      .then((g) => {
        setGraph(g);
        setEdges(
          g.edges.map((e) => ({
            id: `e${e.edge_id}`,
            source: String(e.source_node_id),
            target: String(e.target_node_id),
            label: e.label ?? undefined,
          })),
        );
      })
      .catch((e) => setError(e instanceof ApiError ? String(e.detail) : String(e)));
  }, [projectId]);

  useEffect(() => () => wsRef.current?.close(), []);

  const nodes: Node[] = useMemo(() => {
    if (!graph) return [];
    const pos = layoutVertical(graph);
    return graph.nodes.map((n) => ({
      id: String(n.node_id),
      type: 'pmNode',
      data: n,
      position: pos[n.node_id] ?? { x: 0, y: 0 },
      draggable: false,
      style: {
        borderRadius: 8,
        border: `2px solid ${BORDER[nodeStatus[n.node_id] ?? 'idle']}`,
      },
    }));
  }, [graph, nodeStatus]);

  const run = useCallback(async () => {
    let variables: Record<string, string> = {};
    if (varsText.trim()) {
      try {
        variables = JSON.parse(varsText) as Record<string, string>;
      } catch {
        setError('Variables must be valid JSON.');
        return;
      }
    }
    setError(null);
    setStatus('running');
    setSteps([]);
    setNodeStatus({});
    wsRef.current?.close();
    try {
      const out = await api.post<TestRunOut>(`/projects/${projectId}/flow/run`, {
        variables,
      });
      const ws = connectFlowRunWs(out.run_id, {
        onMessage: (msg) => {
          if (msg.event === 'NODE_RUNNING') {
            setNodeStatus((m) => ({ ...m, [msg.node_id]: 'running' }));
            setSteps((s) => [
              ...s,
              { node_id: msg.node_id, node_key: msg.node_key, status: 'running' },
            ]);
          } else if (msg.event === 'NODE_DONE') {
            const st: NodeStatus = msg.skipped ? 'skipped' : 'done';
            setNodeStatus((m) => ({ ...m, [msg.node_id]: st }));
            setSteps((s) =>
              s.map((step, i) =>
                i === s.length - 1 && step.node_id === msg.node_id
                  ? {
                      ...step,
                      status: st,
                      output: msg.output,
                      latency_ms: msg.latency_ms,
                      tokens: msg.tokens,
                    }
                  : step,
              ),
            );
          } else if (msg.event === 'FAILED') {
            if (msg.node_id != null) {
              setNodeStatus((m) => ({ ...m, [msg.node_id as number]: 'failed' }));
            }
            setError(msg.error);
            setStatus('failed');
            ws.close();
          } else if (msg.event === 'DONE') {
            setStatus('done');
            ws.close();
          }
        },
        onClose: (ev) => {
          setStatus((s) => {
            if (s === 'running') {
              setError(`WebSocket closed (code ${ev.code}).`);
              return 'failed';
            }
            return s;
          });
        },
      });
      wsRef.current = ws;
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : String(e));
      setStatus('failed');
    }
  }, [projectId, varsText]);

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        title={`Project #${projectId} — Flow`}
        right={
          <button
            onClick={() => router.push(`/projects/${projectId}/graph`)}
            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
          >
            Back to graph
          </button>
        }
      />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        <aside className="flex w-96 flex-col overflow-hidden border-l border-slate-200 bg-white">
          <div className="space-y-2 border-b border-slate-200 p-4">
            <div className="text-xs font-semibold text-slate-500">Input variables (JSON)</div>
            <textarea
              value={varsText}
              onChange={(e) => setVarsText(e.target.value)}
              rows={4}
              className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={run}
                disabled={status === 'running'}
                className="rounded bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {status === 'running' ? 'Running…' : 'Run flow'}
              </button>
              <span className="text-xs text-slate-500">status: {status}</span>
            </div>
            {error && (
              <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-2 text-xs font-semibold text-slate-500">Trace</div>
            <TraceViewer steps={steps} />
          </div>
        </aside>
      </div>
    </div>
  );
}
