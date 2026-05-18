'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  applyNodeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import TopBar from '@/components/ui/TopBar';
import NodeCard from '@/components/graph/NodeCard';
import { api } from '@/lib/api';
import { layoutVertical } from '@/lib/graphLayout';
import type { Graph, GraphNode } from '@/types';

const nodeTypes = { pmNode: NodeCard };

export default function GraphPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [dirty, setDirty] = useState(false);
  const admin = true; // auth removed — all actions permitted

  useEffect(() => {
    api.get<Graph>(`/projects/${projectId}/graph`).then((g) => {
      setGraph(g);
      const pos = layoutVertical(g);
      setNodes(
        g.nodes.map((n) => ({
          id: String(n.node_id),
          type: 'pmNode',
          data: n,
          position: pos[n.node_id] ?? { x: 0, y: 0 },
          draggable: admin,
        })),
      );
      setEdges(
        g.edges.map((e) => ({
          id: `e${e.edge_id}`,
          source: String(e.source_node_id),
          target: String(e.target_node_id),
          label: e.label ?? undefined,
          animated: false,
        })),
      );
    });
  }, [projectId, admin]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      if (changes.some((c) => c.type === 'position' && !c.dragging)) setDirty(true);
    },
    [],
  );

  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => {
      const found = graph?.nodes.find((n) => String(n.node_id) === node.id) || null;
      setSelected(found);
    },
    [graph],
  );

  async function saveLayout() {
    const positions = nodes.map((n) => ({
      node_id: Number(n.id),
      pos_x: n.position.x,
      pos_y: n.position.y,
    }));
    await api.put<Graph>(`/projects/${projectId}/graph`, { positions });
    setDirty(false);
  }

  const right = useMemo(
    () => (
      <div className="flex gap-2">
        <button
          onClick={() => router.push(`/projects/${projectId}/flow`)}
          className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
        >
          Run flow
        </button>
        {admin && (
          <button
            onClick={saveLayout}
            disabled={!dirty}
            className="rounded bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-40"
          >
            Save layout
          </button>
        )}
      </div>
    ),
    [admin, dirty, nodes, projectId, router],
  );

  return (
    <div className="flex h-screen flex-col">
      <TopBar title={`Project #${projectId} — Graph`} right={right} />
      <div className="flex flex-1">
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onNodeClick={handleNodeClick}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable />
          </ReactFlow>
        </div>
        <aside className="w-80 border-l border-slate-200 bg-white p-4">
          {selected ? (
            <>
              <div className="text-xs uppercase text-slate-400">{selected.node_type}</div>
              <h2 className="mb-1 text-base font-semibold">{selected.node_nm}</h2>
              <div className="text-xs text-slate-500">key: {selected.node_key}</div>
              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Active Prompt</dt>
                  <dd className="font-mono">
                    {selected.active_prompt
                      ? `v${selected.active_prompt.version_no} (#${selected.active_prompt.prompt_id})`
                      : '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Active Model</dt>
                  <dd className="font-mono">
                    {selected.active_model
                      ? `${selected.active_model.model_provider} / ${selected.active_model.model_nm}`
                      : '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Description</dt>
                  <dd className="text-slate-700">{selected.description || '-'}</dd>
                </div>
              </dl>
              <div className="mt-4 grid gap-2">
                <button
                  onClick={() =>
                    router.push(`/projects/${projectId}/nodes/${selected.node_id}/prompts`)
                  }
                  className="w-full rounded bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800"
                >
                  Manage prompts
                </button>
                <button
                  onClick={() =>
                    router.push(`/projects/${projectId}/nodes/${selected.node_id}/test`)
                  }
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                >
                  Test node
                </button>
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500">Click a node to inspect.</div>
          )}
        </aside>
      </div>
    </div>
  );
}
